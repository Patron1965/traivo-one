# Kinab DEV → PROD Slim-migrering (Task #423)

Förbereder publicerad prod-instans för parallelldrift mot Kinabs Modus-system
genom att importera en **ren delmängd** av dev-data istället för full kopiering.

## Vad som tas med

**Konfiguration (config-fas):**
- `tenants` (`kinab`), `tenant_branding`, `tenant_features`
- `users` (de som har `user_tenant_roles` för kinab) + `user_tenant_roles`
- `resources`, `resource_profiles`, `resource_profile_assignments`
- `teams`, `team_members`
- `vehicles`, `equipment`, `resource_vehicles`, `resource_equipment`
- `articles`, `article_components`, `resource_articles`
- `price_lists` (utan `customer_id`) + `price_list_articles`
- `checklist_templates`, `metadata_definitions`
- `fortnox_config`, `fortnox_mappings`
- `planning_parameters` (tenant-nivå)
- Order-koncept-tabeller om de finns

**Aktiva kunder (customers-fas):**
- "Aktiv kund" = kund med minst en `work_order` med `scheduled_date >= 2024-01-01` (~486 st i dev)
- `customers`, kund-specifika `price_lists` + `price_list_articles`
- `clusters` (+ alla utan `root_customer_id`)
- `customer_notification_settings`, `customer_service_contracts`
- `portal_users`, `portal_user_object_scopes`
- `objects` (kopieras nivå-för-nivå för parent-FK), `object_parents`,
  `object_metadata`, `object_contacts`, `object_images`, `object_articles`,
  `object_payers`, `object_time_restrictions`
- `planning_parameters` (kund/objekt-nivå)
- `metadata_varden` utan koppling till `work_order_id`

**Rensas i prod (cleanup-fas):**
- De testkunder som finns i prod för `kinab` (max 10 — säkerhetslås)
- Alla deras objekt + work_orders + alla beroende rader

## Vad som **inte** tas med (skip)

- `work_orders` och alla underliggande tabeller (lines, dependencies, protocols,
  visit_confirmations, technician_ratings, eta_notifications osv)
- `subscriptions`, `subscription_changes`
- `procurements`, `assignments`, `assignment_articles`
- `setup_time_logs`, `customer_invoices`, `manual_invoice_lines`
- `metadata_historik`, `audit_logs` osv
- 1809 vilande kunder (saknar work_order ≥ 2024)

Detta för att starta Modus-parallelldriften med ren slate på transaktionssidan.

## Förkrav

1. **Schema måste vara synkat.** Replit Publish kör en schema-diff vid publicering
   — säkerställ att senaste publicering är klar **innan** skriptet körs. Se
   `.local/skills/database/references/database-migrations-on-publish.md`.
2. **`PROD_DATABASE_URL`** måste finnas som Secret. Hämta via Replit Publish-
   panelen → Production Database → Connection string. Den får **inte** vara
   samma som `DATABASE_URL`.
3. **Backup.** Replit tar checkpoints automatiskt, men ta gärna en manuell
   `pg_dump` av prod-DB:n innan kör. Se Publish → Database → Snapshots.

## Körning

Skriptet använder en **enda transaktion** mot prod — utan
`CONFIRM=YES_MIGRATE_PROD` rullas allt tillbaka i slutet. Det betyder att en
dry-run faktiskt skriver in datan tillfälligt och rullar tillbaka, vilket
verifierar att alla FK och constraints håller.

```bash
# 1) Dry-run (transaktion + ROLLBACK), recommended first
PROD_DATABASE_URL='postgres://...' \
  npx tsx scripts/migrate-kinab-dev-to-prod.ts --phase=all --dry-run

# 2) Endast cleanup, dry-run
PROD_DATABASE_URL='postgres://...' \
  npx tsx scripts/migrate-kinab-dev-to-prod.ts --phase=cleanup --dry-run

# 3) Skarp körning (committar)
PROD_DATABASE_URL='postgres://...' CONFIRM=YES_MIGRATE_PROD \
  npx tsx scripts/migrate-kinab-dev-to-prod.ts --phase=all
```

### Flaggor

| Flag | Default | Beskrivning |
|---|---|---|
| `--phase` | `all` | `cleanup` / `config` / `customers` / `all` |
| `--dry-run` | (av) | Tvinga rollback även med `CONFIRM` |
| `--tenant` | `kinab` | Vilken tenant |
| `--active-since` | `2024-01-01` | Tröskel för "aktiv kund" |
| `--batch` | `500` | Insert-batch-storlek |

### Env-overrides

| Var | Beskrivning |
|---|---|
| `CONFIRM=YES_MIGRATE_PROD` | Krävs för faktisk commit. Annars dry-run. |
| `TEST_CUSTOMER_IDS=id1,id2` | Explicit lista vid cleanup. Annars: alla nuvarande prod-kunder för `kinab` (max 10). |

## Idempotens & säkerhet

- **Upsert** via `INSERT ... ON CONFLICT (id) DO UPDATE SET ...`. Skriptet kan
  köras om utan att duplicera rader; befintliga rader i prod skrivs över med
  dev-version.
- **En transaktion**: BEGIN ... COMMIT/ROLLBACK runt alla skrivningar. Inga
  delvis applicerade ändringar.
- **Säkerhetslås**: cleanup vägrar köra om prod har > 10 kunder för tenanten
  utan att `TEST_CUSTOMER_IDS` är explicit satt.
- **Schema-diff-tolerant**: kopierar bara kolumner som finns i båda DB.

## Output

`migration-report-YYYYMMDD-HHMM.md` i projektroten med:
- Body: `Tenant`, `Phase`, `Dry-run`, `Committed`, antal kunder före/efter
- Tabell per tabell: `Hämtade | Upserterade | Raderade`

## Efter körning

1. Verifiera kund- och objekt-räkningarna i prod.
2. Logga in som tenant-admin i prod-appen, kontrollera Customers, Objekt,
   Resurser, Team, Artiklar, Prislistor, Fortnox-status.
3. Kinab kör Modus-import skarpt mot prod.
4. Befintliga work_orders kommer skapas via Modus-importen (eller manuellt).

## Rollback

Om något gått snett **efter commit**: Replit Publish → Database → Restore from
snapshot. Skriptet stödjer inte själv-rollback efter `COMMIT`.
