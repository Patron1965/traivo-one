---
name: Wizard create-then-append flows
description: How multi-step "skapa WO + posta rader" wizards must handle partial failure to avoid duplicate parents.
---

# Wizard create-then-append flows (Enkel uppgift m.fl.)

Flöden som först skapar en parent (t.ex. `POST /api/work-orders`) och därefter
postar barn-rader en-och-en (`POST /api/work-orders/:id/lines`) får **aldrig**
behandla ett enda misslyckat radanrop som ett totalfel där hela `handleCreate`
körs om från början.

**Regel:** Omslut endast parent-skapandet i det yttre `try` vars `catch`
behåller dialogen öppen för säker retry. Posta raderna i egna `try/catch` och
räkna `lineFailures`. När parent finns: invalidera, kör `onCreated`, stäng
dialogen — och visa en varnings-toast om någon rad föll bort (be användaren
öppna uppgiften och lägga till dem manuellt).

**Why:** Annars: parent + några rader skapas, en senare rad failar, generisk
fel-toast visas, dialogen står kvar, användaren trycker "Skapa" igen → en NY
parent + ALLA rader postas på nytt = dubblett-WO. Upptäckt i code review av
enkel-uppgift-wizarden.

**How to apply:** Gäller alla nya wizards/dialogs i klienten som saknar en
atomisk batch-endpoint.

**Uppdatering:** Den atomiska batch-endpointen finns nu:
`POST /api/work-orders/with-lines` (`{ workOrder, lines }`) skapar WO + alla
rader i EN DB-transaktion via `storage.createWorkOrderWithLines` (allt-eller-
inget; rullar tillbaka hela ordern om en rad failar). Pris/tid resolvas före
transaktionen, totaler räknas om inom den. `EnkelUppgiftWizard` använder den för
nya uppgifter. Tillägg på *befintlig* order postar fortfarande rader en-och-en
(ordern finns redan → ingen partiell-parent-risk) och behåller `lineFailures`-
mönstret. Nya batch-create-flöden bör återanvända with-lines-endpointen i stället
för create-then-append.
