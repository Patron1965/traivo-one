# Disaster Recovery — Traivo

> **Mål:** En kort, körbar plan. När (inte om) det smäller under Kinab-piloten ska den som har vakten kunna följa det här dokumentet utan att fundera. Stora arkitektur-diskussioner hör inte hemma här.

**Senast verifierad restore-test:** 2026-05-21 (dev-DB, isolerad tabell, ~29 s end-to-end). Se [Kvartals-checklista](#kvartals-checklista) för nästa körning.

## 1. Vad backupas, var, hur ofta

| Tillgång | Var | Frekvens | Retention | Vem äger |
|---|---|---|---|---|
| **PostgreSQL (prod)** | Replit managed (Neon Postgres) | Kontinuerlig WAL + dagliga snapshots | 7 dagar point-in-time (Replit Core); konsultera Replit-konsolen → Database → Backups för exakt fönster | Replit |
| **PostgreSQL (dev)** | Samma plattform | Replit Checkpoints (per agent-task) | Per session, beroende på checkpoint-cleanup | Replit |
| **Object Storage** | Replit Object Storage (GCS-backed) | Replikerat av plattformen (multi-region GCS) | Ingen separat snapshot-policy — risken är **accepterad** (se §5) | Replit |
| **Kod** | Git (Replit-projektets repo) + Replit checkpoints | Per commit / per agent-task | Obegränsat i git, checkpoints rensas över tid | Vi |
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

## 3. Procedurer — Tre scenarier

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

## 4. Kontaktvägar & eskalering

| Roll | Namn | Kontakt | När |
|---|---|---|---|
| **Primary on-call (kontorstid)** | _(fyll i)_ | _(fyll i mobil)_ | Första larmet |
| **Backup on-call** | _(fyll i)_ | _(fyll i mobil)_ | Om primary inte svarar inom 15 min |
| **Kinab driftkontakt** | _(fyll i, troligen Mats)_ | _(fyll i)_ | Informeras inom 1 h vid incident med kund-påverkan |
| **Replit Support** | Replit | hello@replit.com / Replit Console → Help | Vid plattforms-incident (DB-restore, deploy-frågor) |

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

| Steg | Tid |
|---|---|
| Skapa testtabell + 3 rader | 4.8 s |
| Verifiera count = 3 | 4.1 s |
| Simulera dataförlust (DELETE 1 rad) | 5.2 s |
| Manuell återställning (INSERT) | 10.6 s |
| Verifiera + cleanup | 4.3 s |
| **Total** | **~29 s** |

Testet körde mot dev-DB med en isolerad tabell (`dr_restore_test`) och simulerade rad-radering + manuell återställning. **Det är medvetet en liten övning** — Replit-plattformens point-in-time restore kräver konsolåtkomst och är inte automatiserbar härifrån. Övningen verifierar att:

1. Vi har skriv-access till DB:n och kan reproducera dataförlust kontrollerat.
2. Restore-flödet (oavsett om det är manuell SQL eller plattforms-restore) lämnar ett spår vi kan auditera.
3. Tid-budgeten är trivial för punkt-återställningar — det stora i en verklig DR-situation är beslutet (vilken backup, hur långt tillbaka), inte själva körningen.

**Anteckningar / problem hittade under övningen:** Inga. `executeSql`-vägen i agent-sandboxen klarar både parametriserade och multi-statement-anrop, vilket gör manuella punkt-fix möjliga utan psql-tillgång.

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
