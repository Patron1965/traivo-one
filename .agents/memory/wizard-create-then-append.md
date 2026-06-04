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
atomisk batch-endpoint. Den riktiga långsiktiga lösningen är en batch-endpoint
som skapar WO + rader i en DB-transaktion (se follow-up).
