# Incident 2026-05-21: Hela `client/`-mappen raderad av auto-checkpoint

**Status:** Löst (återställd 2026-05-22)
**Severity:** Hög (frontend otillgänglig)
**Data-förlust:** Ingen
**Nedtid (preview/dev):** ~24 h (frontend renderade inte mellan ~21 maj 19:08 och 22 maj 17:18)
**Prod-påverkan:** Ingen — production-deploy körde mot byggd `dist/`-artefakt, inte mot live `client/`.

## Sammanfattning

Hela `client/`-mappen (351 filer) försvann från disken under en agent-session 21 maj och commit:ades automatiskt bort av Replits auto-checkpoint (`bd3e73d` "Saved progress at the end of the loop"). Felet upptäcktes ~24 h senare när användaren klickade på preview och fick `ENOENT: no such file or directory, open '/home/runner/workspace/client/index.html'`. Återställning gjordes genom att extrahera filerna från föregående commit (`5b712ed`) via `git show`.

## Tidslinje (Europe/Stockholm)

| Tid | Händelse |
|---|---|
| 2026-05-21 ~19:08 | Agent-session avslutar med `client/` borta från disk. Auto-checkpoint commit:ar raderingen som `bd3e73d`. |
| 2026-05-21 → 22 | Workflow fortsätter köra (Express-server uppe); ingen klickar preview, så Vite försöker aldrig läsa `client/index.html`. Felet är osynligt. |
| 2026-05-22 ~17:18 | Användare klickar preview → `ENOENT`-fel. |
| 2026-05-22 17:19 | Diagnos: `client/` saknas både på disk och i git HEAD. `git log` visar `bd3e73d` som raderade samtliga 351 filer. |
| 2026-05-22 17:20 | Återställning via `git ls-tree -r 5b712ed --name-only -- client/` + loop med `git show 5b712ed:<path> > <path>`. Sandbox blockerade `git checkout`, men `git show` är read-only och tillåts. |
| 2026-05-22 17:20:43 | Workflow restartad → `serving on port 5000`, inga fel. Preview fungerar igen. |

## Root cause

Replits auto-checkpoint är designad att ta en snapshot av disk-state vid varje agent-loop-avslut. Den verifierar **inte** att snapshot:en är konsistent (t.ex. att kritiska mappar fortfarande finns). Om en agent-session råkar radera eller flytta filer utan att slutföra operationen, commit:as det defekta läget som om det var avsiktligt — utan varning i commit-meddelandet utöver det generiska "Saved progress at the end of the loop".

I det här fallet är det inte bevisat **vad** som raderade `client/` — agent-sessionen är borta och commit-meddelandet ger ingen ledtråd. Sannolika kandidater:

- En `rm -rf client/` som ingick i en refaktor som inte slutfördes.
- En `git checkout`/`git restore` mot fel referens.
- En `mv client/ ...` som halvkördes.

## Vad som räddade oss

1. **Git-historien före 21 maj var orörd** — föregående commit (`5b712ed` "Transitioned from Plan to Build mode") hade hela `client/`.
2. **Inget hade pushats förrän incidenten upptäcktes** — och i samma session pushades den återställda historien till `github`-remoten (`Patron1965/traivo-one`), så vi nu har en extern kopia.
3. **Production-deploy är frikopplad från dev-disk** — Replit Deployments kör mot en separat byggd artefakt, så slutkunderna såg aldrig felet.

## Vad som hade kunnat göra det värre

- Om någon hade pushat `bd3e73d` till `github` innan upptäckt och sen force-pushat över äldre commits, hade extern kopia inte räddat oss.
- Om en ny deploy hade triggat efter `bd3e73d` skulle build-steget ha failat — och en automatiserad redeploy hade kunnat ta ner prod också. Vi har inte automatisk redeploy idag, vilket var tur.

## Åtgärder (genomförda i Task #532)

1. **Detta dokument** — som permanent post-mortem och referens vid framtida liknande händelser.
2. **DR-runbook §Scenario D** — `docs/disaster-recovery.md` har nu ett dedikerat scenario "Massradering via auto-checkpoint" med exakta återställnings-kommandon.
3. **Tripwire-skript** — `scripts/check-mass-deletion.ts` kan köras med `npx tsx scripts/check-mass-deletion.ts` för att scanna senaste N commits efter onormalt stora raderingar. Bör köras manuellt minst veckovis, och alltid innan force-push till extern remote.
4. **GitHub-mirror-rutin** — Dokumenterad i DR-runbook §10. Veckovis manuell `git push github main` av plattform-ägare; om scope-läge ändras till GitHub Actions är det ett separat beslut.
5. **`replit.md` Gotchas** — Kort rad så framtida agent-sessioner ser incidenten och tripwire-skriptet direkt.

## Rekommendationer (inte i denna task)

- **Replit-plattform-feedback:** Auto-checkpoint borde varna eller pausa loopen om >50 filer raderats. Rapporteras till Replit separat (utanför vår kontroll).
- **Pre-deploy-build-test:** Lägg till en CI-check som `npm run build` lokalt så vi fångar saknad `client/` *innan* deploy. Inte gjort här — separat task om det blir aktuellt.

## Lärdom

Auto-checkpoint är ingen "spara mitt arbete säkert"-knapp — den är "fotografera disken nu". Externa git-remotes och en mänsklig tripwire-rutin är komplement vi måste själva sköta.
