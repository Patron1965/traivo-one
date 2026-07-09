# Klassningsförslag: enkelvärde / katalogvärde

> Genererad 2026-07-09 av `scripts/generate-metadata-klassning.ts` (Task #1213, Etapp 1).
> Förslag för produktägarens godkännande — INGENTING är ändrat i databasen.

**Enkelvärde** = fältet har ett gällande värde per objekt; nytt värde arkiverar automatiskt det gamla som fullvärdig arkiverad post (G1).
**Katalogvärde** = flera samtidiga värden av samma fält kan finnas på ett objekt (t.ex. flera ytor, flera kontakter).

## Heuristik
1. `allow_duplicates = true` idag → **Katalogvärde** (befintlig klassning behålls).
2. Något objekt har redan flera aktiva egna värden → **Katalogvärde** (data motsäger enkelvärde).
3. Kronologisk visning aktiv → **Katalogvärde** (tidslinje bygger på flera poster).
4. Övrigt → **Enkelvärde**.

## Tenant: Kinab AB

| Fält | Datatyp | Kategori | Idag (allow_duplicates) | Aktiva värden | Objekt m. flera | Förslag | Motivering |
|---|---|---|---|---:|---:|---|---|
| `Förälder` | referens | administrativ | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Kundkoppling` | referens | administrativ | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Objekttyp` | string | administrativ | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `PE-Lyftkrok-test-1781183033370-thv5xz` | string | annat | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `PE-Lyftkrok-test-1781183195202-fjzlju` | string | annat | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `PE-Lyftkrok-test-1781183270736-uubppf` | string | annat | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `PE-Lyftkrok-test-1782394810021-hvvex8` | string | annat | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Association` | string | artikel | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Senast fakturerad order` | string | ekonomi | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Avdelning/Port/Våning` | string | geografi | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Fördjupad position` | location | geografi | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Gatuadress` | string | geografi | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Koordinater` | location | geografi | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Område` | string | geografi | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Postnummer` | string | geografi | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Postort` | string | geografi | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `What3words` | string | geografi | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Fastighetsägare` | string | grunduppgifter | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Kontakt` | string | grunduppgifter | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Kundnummer` | string | grunduppgifter | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Objektnamn` | string | grunduppgifter | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Vinjetbild` | image | grunduppgifter | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Area` | string | importerad | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Er referens` | string | importerad | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Ert ordernummer` | string | importerad | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Nyckel eller kod` | string | importerad | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Rumsstorlek` | string | importerad | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Avdelning` | string | kundreferens | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Butiksnummer` | string | kundreferens | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Fakturareferens` | string | kundreferens | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Fasadnummer` | string | kundreferens | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Fastighetsbeteckning` | string | kundreferens | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Leveransintervall` | string | leverans | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Oönskad leveransperiod` | string | leverans | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Önskad leveransperiod` | string | leverans | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Antal` | integer | produktion | nej | 0 | 0 | **Katalogvärde** | Kronologisk visning (tidslinje) |
| `Färg` | string | produktion | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Lyftkrok` | string | produktion | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Storlek` | string | produktion | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Typ` | string | produktion | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Tömningsdag` | string | produktion | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Uppdragsbild` | image | produktion | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Visningsbild` | image | produktion | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Yta` | decimal | produktion | ja | 0 | 0 | **Katalogvärde** | Redan klassat som dubblerbart |
| `Senast inställd order` | string | status | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Senast slutförd order` | string | status | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Senaste arbetsorder` | string | status | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Senaste felanmälan` | string | status | nej | 0 | 0 | **Katalogvärde** | Kronologisk visning (tidslinje) |
| `Senaste kundbetyg` | string | status | nej | 0 | 0 | **Katalogvärde** | Kronologisk visning (tidslinje) |

## Tenant: Move/Copy Test A

| Fält | Datatyp | Kategori | Idag (allow_duplicates) | Aktiva värden | Objekt m. flera | Förslag | Motivering |
|---|---|---|---|---:|---:|---|---|
| `What3words` | string | geografi | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Fastighetsägare` | string | grunduppgifter | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Kundnummer` | string | grunduppgifter | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |

## Tenant: Move/Copy Test B

| Fält | Datatyp | Kategori | Idag (allow_duplicates) | Aktiva värden | Objekt m. flera | Förslag | Motivering |
|---|---|---|---|---:|---:|---|---|
| `What3words` | string | geografi | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Fastighetsägare` | string | grunduppgifter | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Kundnummer` | string | grunduppgifter | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |

## Tenant: OIV2 Test

| Fält | Datatyp | Kategori | Idag (allow_duplicates) | Aktiva värden | Objekt m. flera | Förslag | Motivering |
|---|---|---|---|---:|---:|---|---|
| `Avdelning/Port/Våning` | string | geografi | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Fördjupad position` | location | geografi | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Gatuadress` | string | geografi | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Koordinater` | location | geografi | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Postnummer` | string | geografi | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Postort` | string | geografi | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `What3words` | string | geografi | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Fastighetsägare` | string | grunduppgifter | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Kundnummer` | string | grunduppgifter | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |

## Tenant: ObjectDetail Save-Flow Test

| Fält | Datatyp | Kategori | Idag (allow_duplicates) | Aktiva värden | Objekt m. flera | Förslag | Motivering |
|---|---|---|---|---:|---:|---|---|
| `What3words` | string | geografi | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `What3words` | string | geografi | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Fastighetsägare` | string | grunduppgifter | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Fastighetsägare` | string | grunduppgifter | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Kundnummer` | string | grunduppgifter | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Kundnummer` | string | grunduppgifter | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |

## Tenant: Objekt-metadata arv-skriv Test

| Fält | Datatyp | Kategori | Idag (allow_duplicates) | Aktiva värden | Objekt m. flera | Förslag | Motivering |
|---|---|---|---|---:|---:|---|---|
| `What3words` | string | geografi | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Fastighetsägare` | string | grunduppgifter | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Kundnummer` | string | grunduppgifter | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |

## Tenant: Snabbfälts-konfig Test

| Fält | Datatyp | Kategori | Idag (allow_duplicates) | Aktiva värden | Objekt m. flera | Förslag | Motivering |
|---|---|---|---|---:|---:|---|---|
| `What3words` | string | geografi | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `What3words` | string | geografi | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Fastighetsägare` | string | grunduppgifter | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Fastighetsägare` | string | grunduppgifter | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Kundnummer` | string | grunduppgifter | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Kundnummer` | string | grunduppgifter | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |

## Tenant: Team-infer test tenant

| Fält | Datatyp | Kategori | Idag (allow_duplicates) | Aktiva värden | Objekt m. flera | Förslag | Motivering |
|---|---|---|---|---:|---:|---|---|
| `What3words` | string | geografi | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Fastighetsägare` | string | grunduppgifter | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Kundnummer` | string | grunduppgifter | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |

## Tenant: Tenant B (test)

| Fält | Datatyp | Kategori | Idag (allow_duplicates) | Aktiva värden | Objekt m. flera | Förslag | Motivering |
|---|---|---|---|---:|---:|---|---|
| `What3words` | string | geografi | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Fastighetsägare` | string | grunduppgifter | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Kundnummer` | string | grunduppgifter | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |

## Tenant: eres-1782394757574-780t7m-a

| Fält | Datatyp | Kategori | Idag (allow_duplicates) | Aktiva värden | Objekt m. flera | Förslag | Motivering |
|---|---|---|---|---:|---:|---|---|
| `eres-1782394757574-780t7m-a-Tillverkare` | string | beskrivning | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `eres-1782394757574-780t7m-a-Volym` | integer | beskrivning | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `What3words` | string | geografi | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Fastighetsägare` | string | grunduppgifter | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |
| `Kundnummer` | string | grunduppgifter | nej | 0 | 0 | **Enkelvärde** | Ett gällande värde per objekt |

## Sammanfattning

- Totalt 90 aktiva katalogfält (arkiverade fält exkluderade).
- Föreslagna enkelvärden: **86**
- Föreslagna katalogvärden: **4**

Godkännande: produktägaren bockar av per rad; avvikelser ändras via Inställningar → Metadata (växeln "Katalogvärde (flera värden)").
