---
name: Dynamisk abonnemangsavgift
description: Orderkoncept-abonnemang fakturerar beräknad avgift (ordervärde) i stället för ett statiskt manuellt fält.
---

# Dynamisk abonnemangsavgift (orderkoncept)

Abonnemangskonceptens avgift härleds DYNAMISKT från summan av uppgifternas
ordervärde knutet till objekten — inte från ett statiskt manuellt avgiftsfält.

**Regel:** `computeConceptSubscriptionFee` (server/services/order-concept-subscription.ts)
är ENDA kanoniska källan för den beräknade avgiften. Den wrappar den vanliga
ordervärdes-motorn (`computeConceptOrderValue`, ÖRE). ALLA paths måste gå via den:
schemaläggare (löpande fakturering), manuell aktivering, förhandsvisning,
subscription-calc, detect-changes, validate och Granska. Lägg aldrig till en ny
path som räknar avgiften på annat sätt → divergens mot den visade avgiften.

**Why:** Tidigare angavs avgiften manuellt och en blockerande "saknas"-varning
stoppade aktivering. Nu speglar avgiften faktiskt ordervärde och delas per fakturanivå.

**How to apply / gotchas:**
- **Öre vs kronor:** ordervärdes-motorn ger heltals-ÖRE; fakturabelopp lagras i
  KRONOR. Multiplicera öre med antal perioder (heltal) FÖRE division med 100 — annars
  binär-flyt-artefakter.
- **Exakt centfördelning är ett måste:** fördela `totalValueOre` per objekt med
  största-rest-metoden (bas = floor, restören delas ut deterministiskt), ALDRIG
  `Math.round(total/count)` per post — då blir Σ ≠ total vid icke-jämn delning och
  fakturorna driver över/under den kanoniska avgiften. Helpern returnerar en
  per-objekt-array (i objektens ordning) just för att summan per fakturakund ska bli exakt.
- **Fördelning per nivå sker hos anroparen:** gruppera objekten per upplöst fakturakund
  (HARDCODED ⇒ en toppkund; FROM_METADATA ⇒ per-objekt-kund = delning på lägre nivåer)
  och summera per-objekt-allokeringarna. Σ per kund == totalValueOre.
- **canCompute-gate ersätter den gamla guarden:** schemaläggaren hoppar över UTAN att
  avancera nextRunDate när avgiften inte kan beräknas (inget ordervärde) — så ett
  åtgärdat koncept plockas upp nästa tick utan att perioden tappas.
- **Wizard-stegordning:** Fakturering ligger FÖRE Tasks/artiklar, så fakturasteget visar
  ofta "Kan inte beräknas" tills artiklar lagts till. Kanonisk visning är Granska-steget,
  efter artiklar. Inte en bugg.
- **Expand-contract:** det gamla statiska avgiftsfältet (kolumnen) behålls, skrivs ej
  längre i wizard-flödet — ingen drop.
