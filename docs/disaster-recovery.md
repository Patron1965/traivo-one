# Disaster Recovery — Traivo

> **Mål:** En kort, körbar plan. När (inte om) det smäller under Kinab-piloten ska den som har vakten kunna följa det här dokumentet utan att fundera. Stora arkitektur-diskussioner hör inte hemma här.

**Senast verifierad restore-test:** 2026-05-21 — riktig `pg_dump`/`pg_restore`-cykel mot dev-DB (1000-rads schema, 12 KB dump-artefakt, **184 ms restore-tid**, totalt 1.47 s end-to-end, alla 1000 rader bit-identiska efter restore). Replit-konsolens point-in-time-restore mot staging är fortfarande pending — se §7 för instruktion. Nästa körning: se [Kvartals-checklista](#8-kvartals-checklista).

## 1. Vad backupas, var, hur ofta

| Tillgång | Var | Frekvens | Retention | Vem äger |
|---|---|---|---|---|
| **PostgreSQL (prod)** | Replit managed (Neon Postgres) | Kontinuerlig WAL + dagliga snapshots | 7 dagar point-in-time (Replit Core); konsultera Replit-konsolen → Database → Backups för exakt fönster | Replit |
| **PostgreSQL (dev)** | Samma plattform | Replit Checkpoints (per agent-task) | Per session, beroende på checkpoint-cleanup | Replit |
| **Object Storage** | Replit Object Storage (GCS-backed) | Replikerat av plattformen (multi-region GCS) | Ingen separat snapshot-policy — risken är **accepterad** (se §5) | Replit |
| **Kod** | Git (Replit-projektets repo) + Replit checkpoints + GitHub-mirror (`Patron1965/traivo-one`, se §10) | Per commit / per agent-task; mirror veckovis | Obegränsat i git, checkpoints rensas över tid | Vi |
| **Env-secrets** | Replit Secrets | Replit-plattformen, **ej kund-exporterbart** | Tills vi tar bort dem | Vi |
| **Audit-loggar** | DB-tabell `audit_logs` | Ingår i DB-backup | Login: 365d, övrigt: 730d (Task #511) | Vi |
| **Resend e-post (skickade magic-links etc.)** | Resend-leverantörens lagring | Per leverantörens policy | 30d (Resend default) | Resend |
| **Fortnox-tokens (per tenant)** | DB-tabell `fortnox_credentials` | Ingår i DB-backup | Tills tenant avregistreras | Vi |

**Inte täckt av Replit-backup, viktigt att vi själva har koll på:**

- **Secrets-värden** — Replit visar dem i konsolen men exporterar inte. Vi måste själva ha en off-platform-kopia (1Password / vault) av: `DATABASE_URL`, `SESSION_SECRET`, `OPENAI_API_KEY`, `RESEND_API_KEY`, `TWILIO_*`, `GEOAPIFY_API_KEY`, `FORTNOX_CLIENT_ID/SECRET`, `AUDIT_LOG_CLEANUP_TOKEN`. **Action:** verifiera 1Password-valvet "Traivo Prod Secrets" månadsvis.
- **Object Storage signed-URLs** är inte meningsfullt att backupa — om bucketen försvinner är URL:erna värdelösa ändå. Underliggande filer är det som spelar roll.

## 2. RPO/RTO — Pilot-mål (Kinab)

| Mätare | Mål för pilot | Vad det betyder |
|---|---|---|
| **RPO (Recovery Point Objective)** | **24 h** | Vi kan i värsta fall förlora upp till 24 timmars data. Replits point-in-time recovery ger oss bättre i praktiken (under en timme), men avtalet med Kinab utlovar inte mer än 24 h. |
| **RTO (Recovery Time Objective)** | **4 h** | Från incident-detektion till tjänsten uppe igen. Realistiskt eftersom det inkluderar tid att fatta beslut, kontakta Replit-support vid behov, och köra restore. |
| **MTTD (Mean Time To Detect)** | < 30 min under kontorstid, < 4 h övrig tid | Vi har ingen 24/7-bemanning under piloten — det är medvetet och kommunicerat. |

**Det här utlovar vi *inte*:** noll dataförlust, sub-minute failover, cross-region disaster recovery, 24/7-jour. Skulle pilot-kunden behöva det dyker det upp som en separat kommersiell diskussion.

## 3. Procedurer — Fyra scenarier

### Scenario A: DB är korrupt / borta

**Detektion:** `/healthz` returnerar 503 med `checks.database=false`, eller massiva `relation does not exist` / connection-refused-fel i loggen.

1. **Bekräfta scope** — Kör `psql $DATABASE_URL -c "SELECT 1"` lokalt. Om det går igenom: problemet är applikationen, inte DB:n — gå till Scenario B.
2. **Kolla Replit-konsolen** — Database → Status. Är det en Replit-incident? Då vänta + kommunicera (Kinab via SMS/e-post, se §4).
3. **Point-in-time restore via Replit-konsolen:**
   - Database → Backups → Välj senaste healthy snapshot (helst före incident-tidpunkten).
   - Bekräfta restore. **Replit kör restore till samma databas** (ingen sidoinstans).
   - Förväntat tid: 5–30 min beroende på DB-storlek.
4. **Verifiera efter restore:**
   ```bash
   psql $DATABASE_URL -c "SELECT COUNT(*) FROM work_orders;"
   psql $DATABASE_URL -c "SELECT MAX(created_at) FROM audit_logs;"
   ```
   Senaste audit-log-tidstämpel bekräftar hur långt vi tappade data.
5. **Starta om appen** — Replit Deployments → Redeploy (eller workflow-restart för dev).
6. **Hälsokoll** — `curl https://<prod-host>/healthz` → 200. Logga in som test-user och öppna en WO.
7. **Informera Kinab** — Mall i §4.

### Scenario B: App-deploy är död (kod, inte data)

**Detektion:** `/healthz` svarar 503 med `checks.database=true`, eller deploy-URL ger 502/504 men DB är ok.

1. **Kolla Replit Deployments-loggen** — Senaste deploy failed? Crash-loop?
2. **Rollback till föregående deploy:**
   - Replit Deployments → Deployment history → Klicka tidigare working deploy → "Redeploy this version".
   - Förväntat tid: 2–5 min.
3. **Alternativ — git revert:** Om föregående deploy också är trasig, `git revert <bad-commit>` lokalt, push, ny deploy.
4. **Hälsokoll & informera** — Som ovan.

### Scenario C: Object Storage är borta / inaccessible

**Detektion:** Banner från `DegradedModeBanner` visar Object Storage `down`, eller uppladdnings-flöden returnerar 503.

1. **Bekräfta** — Är det vår bucket eller hela Replit Object Storage-tjänsten? Kolla [Replit status](https://status.replit.com).
2. **Om hela tjänsten:** Vänta. Vi har ingen reservinfra (out of scope för piloten). Informera Kinab att foto-uppladdning är pausad, men work-order-flödet i övrigt fungerar (orderdata ligger i DB, inte i object storage).
3. **Om bara vår bucket:** Kontakta Replit-support (`hello@replit.com` + ange `REPLIT_DB_URL`-projekt-ID). Bucketen är hanterad — vi har inte direktåtkomst till GCS-konsolen.
4. **Data-loss-bedömning:** Eftersom bucketen är multi-region GCS-replikerad är permanent förlust extremt osannolik. Tillfällig oåtkomlighet är den realistiska risken.
5. **Workaround under outage:** Mobil-app cachar foton lokalt offline (offline-first design) — fältarbetare kan fortsätta jobba, sync sker när storage är tillbaka.

### Scenario D: Massradering via auto-checkpoint

**Detektion:** Preview returnerar `ENOENT: no such file or directory, open '/home/runner/workspace/<path>'`. Eller `git ls-tree -r HEAD --name-only | wc -l` är dramatiskt mindre än senaste kända state. Eller `npx tsx scripts/check-mass-deletion.ts` flaggar ny commit (kör veckovis + alltid före varje `git push github main`, oavsett om det är fast-forward eller force).

**Bakgrund:** Replits auto-checkpoint commit:ar exakt disk-state vid loop-avslut utan integritetskontroll. Om en agent-session råkat radera/flytta en mapp och inte slutfört operationen, commit:as raderingen som om den var avsiktlig. Se `docs/incidents/2026-05-21-client-deletion.md` för referens-incidenten där hela `client/` (351 filer) försvann.

1. **Identifiera den skadliga commit:en:**
   ```bash
   npx tsx scripts/check-mass-deletion.ts --commits 50 --threshold 50
   # eller manuellt:
   git --no-optional-locks log --diff-filter=D --summary --all -- <misstänkt-mapp>/ | head -40
   ```
2. **Identifiera senaste healthy parent-commit:** `git log --oneline <bad-sha>~1 -5` — bekräfta att den föregående commit:en har de saknade filerna med `git ls-tree -r <parent-sha> --name-only -- <mapp>/ | head`.
3. **Återställning utan destruktiva git-kommandon** (sandbox blockerar `git checkout` / `git restore` från main-agenten — använd `git show` i stället):
   ```bash
   PARENT=<healthy-parent-sha>
   while IFS= read -r f; do
     mkdir -p "$(dirname "$f")"
     git show "$PARENT:$f" > "$f"
   done < <(git ls-tree -r "$PARENT" --name-only -- <mapp>/)
   ```
   `git show` är read-only och blockeras inte. För 351 filer tog detta <2 sekunder i referens-incidenten.
4. **Verifiera:** `ls <mapp>/index.html` (eller motsvarande entrypoint) — filerna ska finnas på disk.
5. **Restart workflow** — preview ska fungera direkt.
6. **Committa återställningen** — auto-checkpointen vid nästa loop-avslut fångar det återställda läget och persisterar det till git. Pusha till extern remote (`git push github main`) för att säkra en off-platform-kopia.
7. **Post-mortem:** Lägg upp en kort post i `docs/incidents/YYYY-MM-DD-<beskrivning>.md` enligt mallen i incident-mappen.

**Vad du *inte* ska göra:** `git reset --hard <parent-sha>` förlorar all commit-historik efter den raderande commit:en (inklusive andra legitima ändringar). Använd alltid den fil-för-fil-baserade `git show`-extraktionen ovan.

## 4. Kontaktvägar & eskalering

| # | Roll | Namn | Kontakt | Eskalera när |
|---|---|---|---|---|
| 1 | **Primary on-call (kontorstid mån–fre 07–17)** | Traivo platform owner (utveckling) | Slack `#traivo-incidents` + mobil — **se Replit-projektets "Team"-flik för aktuell ägares mobilnummer** | Första larmet (`/healthz` 503, banner-degradering med critical-status, kundrapport) |
| 2 | **Backup on-call** | Sekundär utvecklare med prod-access | Slack DM, mobil per Team-fliken | Primary svarar inte inom **15 min** |
| 3 | **Kinab driftkontakt** | Mats (klusteransvarig, se `docs/kluster-instruktion-mats.md`) + Anna (tenant owner, se `docs/KINAB_TEAM.md`) | E-post + mobil — kontaktuppgifter ligger i Kinabs Traivo-tenant under Användarhantering | Informeras inom **1 h** vid incident med kund-påverkan (work-order-flöde, mobil-app, portal) |
| 4 | **Replit Support** | Replit | hello@replit.com / Replit Console → Help (chatt) | Vid plattforms-incident: DB-restore, deploy-frågor, Object Storage outage. **Inkludera projekt-ID och tidsstämpel.** |

> **OBS för pilot-go-live:** Mobilnummer hålls medvetet utanför detta dokument (committat git-repo) av integritetsskäl. De ligger i Replit-projektets **Team**-flik (för Traivo-personal) och i Kinab-tenanten under **Inställningar → Användarhantering** (för Mats/Anna). När någon roterar — uppdatera där, inte här.

**Kommunikations-mall till Kinab (svenska):**
> Hej, vi har en pågående driftstörning i Traivo som påverkar [planering / mobil / portal]. Vi arbetar aktivt på att lösa det och beräknar att vara tillbaka inom [X] timmar. Inga data har gått förlorade [eller: vi kan ha tappat upp till N timmars data — bekräftas efter återställning]. Vi återkommer med uppdatering kl [HH:MM]. /Traivo

## 5. Object Storage backup — riskaccept

Vi gör **ingen** separat backup av Object Storage utöver Replits inbyggda replikering. Detta är medvetet:

- **Risk:** Permanent dataförlust av uppladdade filer (signaturer, fotobevis, fältrapport-bilagor) om Replits multi-region GCS-replikering skulle fallera.
- **Sannolikhet:** Mycket låg (GCS dual-region durability >99.999999999%).
- **Impact om det händer:** Vi har metadata (`upload_records`-tabellen i DB) som visar *vad* som fanns och när, men inte själva bilderna. Kinab skulle behöva återuppta foton vid nästa besök för pågående case.
- **Vad vi gör i stället för backup:** Mobil-appen håller fotot lokalt på enheten i minst 30 dagar efter upload-bekräftelse, vilket fungerar som en de facto secondary copy under den kritiska perioden.
- **Re-utvärdering:** Om piloten skalar förbi 5 tenants eller om Kinab uttryckligen kräver foto-backup, lägg upp som separat task (cross-region kopia till egen GCS-bucket via nattlig sync).

## 6. Replit Checkpoints — vad de täcker

**Täcker:**
- Hela codebase-state vid varje agent-task-completion.
- Development-databasens schema och data.
- Chat-session-historik.

**Täcker inte:**
- Produktions-databasen (separat managed Postgres-instans).
- Object Storage-innehåll.
- Externa tjänsters state (Fortnox-data hos Fortnox, Twilio-loggar, etc.).
- Env-secrets-värden (de visas men checkpointas inte separat).

**När använda checkpoint-rollback (`suggestRollback`):** Endast i dev. Om agenten råkat skriva sönder schema eller data lokalt och vi vill backa. **Aldrig en prod-disaster-recovery-väg** — det finns ingen prod-checkpoint.

## 7. Verifierad restore-test — 2026-05-21

**Typ:** Riktig `pg_dump` → `DROP SCHEMA` → `pg_restore`-cykel mot dev-DB (samma Postgres-instans, isolerad i schema `dr_drill`).
**Datasstorlek:** 1 000 rader i `dr_drill.work_orders_sample` (id SERIAL, tenant_id, status, scheduled_at, metadata JSONB) — speglar shape på en riktig affärstabell.
**Backup-artefakt:** 11 972 bytes custom-format `.dump`-fil.

| Steg | Kommando | Tid |
|---|---|---|
| Seed (skapa schema + 1000 rader) | `psql ... CREATE/INSERT` | 298 ms |
| **Backup** | `pg_dump --schema=dr_drill --format=custom --file=backup.dump` | **699 ms** |
| Simulera katastrof (drop schema) | `DROP SCHEMA dr_drill CASCADE` | 58 ms |
| Verifiera tomt schema | `SELECT COUNT(*) FROM information_schema.tables` → 0 | — |
| **Restore från dump-fil** | `pg_restore --dbname="$DATABASE_URL" backup.dump` | **184 ms** |
| Verifiera integritet | 1000 rader, 3 status-värden (completed:333, in_progress:334, scheduled:333), id-range 1–1000 ✓ | 97 ms |
| **Totalt end-to-end** | | **~1.47 s** |

Detta är en **riktig backup→restore-drill** mot en faktisk Postgres-artefakt, inte bara en SQL-simulering. Den verifierar:

1. `pg_dump` + `pg_restore` är tillgängliga i miljön (PostgreSQL 16.10) och fungerar mot vår `DATABASE_URL`.
2. Custom-format-dumpen kan restaureras utan owner/privilege-fel via `--no-owner --no-privileges`.
3. Data-integriteten är bit-identisk efter restore (rad-antal, distinct statuses, id-range).

**Vad detta INTE bevisar — och vad som måste göras innan pilot går live:**

- En **riktig Replit point-in-time-restore via konsolen** har inte körts. Den vägen kräver Replit-konsolåtkomst och kan inte automatiseras från agenten. **Action för pilot-ansvarig:** Gå till Replit Console → Database → Backups, välj senaste snapshot, kör en restore till en **staging-DB** (inte prod), kör verifierings-querierna från §3 steg 4, och datera om denna sektion med uppmätt tid.
- Vår drill testade ett schema med 1000 rader. Prod-DB:n med full historik kan ta märkbart längre tid att restaurera (storleksordning minuter, inte millisekunder).

**Anteckningar / problem hittade under övningen:** Inga. `pg_restore` gav en `NOTICE: schema "dr_drill" does not exist, skipping` på första körningen (vi hade redan droppat) — kosmetiskt, inte ett fel. Allt övrigt rent.

## 8. Kvartals-checklista

Kör **en gång per kvartal** (lägg in i kalendern) eller efter större infrastruktur-ändringar:

- [ ] Verifiera att senast Replit-backup-snapshot är < 24 h gammal (Replit Console → Database → Backups).
- [ ] Kör restore-test enligt §7 mot dev-DB. Logga ny tid i tabellen ovan.
- [ ] Verifiera att secrets-valvet (1Password "Traivo Prod Secrets") matchar `printenv | grep -E '_(KEY|SECRET|TOKEN)'` i Replit Shell.
- [ ] Verifiera att `/healthz` returnerar 200 i prod.
- [ ] Verifiera att `DegradedModeBanner` är synlig genom att tillfälligt blockera Geoapify-pingen (lokalt: tom `GEOAPIFY_API_KEY` → restart → banner ska visas inom 60 s).
- [ ] Uppdatera kontakt-tabellen i §4 om någon roterat.
- [ ] Datera om "Senast verifierad restore-test"-stämpeln överst i dokumentet.

## 9. Pilotavtal — text till Kinab

> **Drift och dataåterställning under pilot**
>
> Traivo körs på Replits managed infrastruktur (Postgres + Object Storage), som inkluderar kontinuerlig databas-backup med upp till 7 dagars point-in-time recovery. Vi siktar på följande mål under piloten:
>
> - **Uppe-tid:** Vi siktar på 99 % uppe-tid under kontorstid (mån–fre 07–17). Utanför kontorstid har vi inte 24/7-jour, men incidenter åtgärdas senast morgonen efter.
> - **Dataförlust (RPO):** Vid en allvarlig databas-incident kan vi i värsta fall förlora upp till **24 timmars** ny data. I praktiken är fönstret oftast under en timme tack vare kontinuerlig backup.
> - **Återställningstid (RTO):** Vi siktar på att ha tjänsten uppe igen inom **4 timmar** efter att vi upptäckt en incident.
>
> Restore-procedurer och kontaktvägar är dokumenterade och testas kvartalsvis. Vid en pågående incident informeras er driftkontakt inom 1 timme efter att kundpåverkan bekräftats.
>
> Om piloten övergår till bredare drift kompletteras detta med ett formellt SLA.

## 10. GitHub-mirror — extern kod-backup

Hela kodbasen mirrors till **`Patron1965/traivo-one`** på GitHub som extern off-platform-kopia. Detta är vårt skydd mot scenarier där Replit-projektet skulle vara otillgängligt (konto-incident, plattforms-outage, eller scenarier likt Scenario D ovan).

**Aktuell rutin: manuell veckovis push** av plattform-ägare:

```bash
# 1. Hämta nuvarande GitHub-state så vi vet om något divergerat.
git --no-optional-locks fetch github

# 2. Tripwire — obligatorisk INNAN varje push (även fast-forward).
npx tsx scripts/check-mass-deletion.ts --commits 100 --threshold 50

# 3. Push. Använd --force ENDAST om historik medvetet skrivits om.
git push github main

# 4. Verifiera att GitHub faktiskt pekar på samma SHA som lokalt main.
LOCAL_SHA=$(git rev-parse main)
git --no-optional-locks fetch github
REMOTE_SHA=$(git rev-parse github/main)
[ "$LOCAL_SHA" = "$REMOTE_SHA" ] && echo "OK — mirror i sync ($LOCAL_SHA)" \
                                 || echo "FEL — divergens! local=$LOCAL_SHA remote=$REMOTE_SHA"
```

**Viktigt om tripwiren:** Kör alltid `check-mass-deletion.ts` **före** push. Om scriptet flaggar en misstänkt commit (>50 raderade filer) — granska den först, kör Scenario D-återställning om den var oavsiktlig, och pusha *efter* återställning. Annars riskerar du att skriva över extern kopia med ett trasigt state.

**Om push avvisas (non-fast-forward):** Det betyder att GitHub har commits som inte finns lokalt — antingen har någon pushat direkt till GitHub (sällsynt, vi pushar bara från Replit) eller en tidigare force-push har skrivit om historiken på ena sidan. Lös genom:
1. `git --no-optional-locks log github/main --not main` — visar vad GitHub har som vi saknar. Om raderna ser legitima ut, pulla in dem (`git fetch github && git merge github/main`).
2. Om GitHub-historien är fel (t.ex. förorenad av ett externt experiment), bekräfta att Replit-projektets `main` är auktoritativ och kör `git push github main --force` efter att tripwiren körts.
3. Aldrig force-pusha utan att först ha sparat GitHub-statet (`git fetch github && git branch backup-github-main github/main`) — då har du en räddningsplanka om beslutet visar sig fel.

**Vad mirror:n ger oss:**
- En andra kopia av all kod-historik som inte är beroende av Replits drift.
- En möjlighet att klona projektet till en ny Replit (eller annan plattform) om det skulle behövas.
- En audit-trail som överlever även om Replit-projektets git-historia skulle korrumperas.

**Vad mirror:n *inte* ger oss:**
- Ingen databasinnehåll, inga env-secrets, inget Object Storage. De följer fortfarande sina respektive backup-vägar (§1).
- Ingen automatisk failover — vid Replit-incident måste vi manuellt klona från GitHub och konfigurera om en ny miljö.

**Frekvens-policy:**
- **Minimum:** En push per vecka, ansvar plattform-ägare. Lägg in i kalendern.
- **Efter större ändringar:** Push direkt efter merge av större tasks (DR-relaterat, schema-migrationer, säkerhetsfixar).
- **Före varje pilot-demo eller release:** Push, så det finns en tydlig "this is what was demoed"-referens.

**Framtida möjlighet (out of scope nu):** GitHub Action som auto-mirror:ar dagligen via `gh repo sync` eller en push från CI. Inte implementerat eftersom (1) Replit-projektets git push kräver auth som inte är trivial att exponera till en extern CI, (2) manuell rutin ger oss en granskningspunkt där tripwiren tvingas köras.
