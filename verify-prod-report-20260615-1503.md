# Kinab prod-verifikation 20260615-1503

- Tenant: `kinab`
- Dev-diff: PÅ
- Förväntat min antal aktiva kunder: 400

**Resultat:** FAIL (PASS=12, WARN=4, FAIL=8)

## Räknesatser (PROD)

| Tabell / mått | PROD | DEV |
|---|---:|---:|
| tenants (id=$1) | 1 | – |
| tenant_branding | 1 | – |
| tenant_features | 1 | – |
| users (kinab-roller) | 5 | – |
| user_tenant_roles | 5 | – |
| customers (aktiva) | 0 | 37 |
| customers (totalt) | 0 | – |
| objects (aktiva) | 0 | 95 |
| clusters | 0 | – |
| resources | 5 | 25 |
| resource_profiles | 0 | – |
| resource_profile_assignments | 0 | – |
| teams | 7 | 23 |
| team_members | 0 | – |
| vehicles | 1 | – |
| equipment | 0 | – |
| articles | 2 | 7 |
| article_components | 0 | – |
| price_lists (tenant) | 0 | 0 |
| price_lists (kund) | 0 | – |
| price_list_articles | 0 | – |
| checklist_templates | 0 | – |
| metadata_definitions | 0 | – |
| portal_users | 0 | – |
| portal_user_object_scopes | 0 | – |
| fortnox_config | 0 | – |
| fortnox_mappings | 0 | – |
| work_orders (förväntat 0) | 0 | – |

## Checkar

| Status | Check | Detalj |
|---|---|---|
| INFO | count: tenants (id=$1) | 1 |
| INFO | count: tenant_branding | 1 |
| INFO | count: tenant_features | 1 |
| INFO | count: users (kinab-roller) | 5 |
| INFO | count: user_tenant_roles | 5 |
| FAIL | count: customers (aktiva) | 0 kunder — under förväntat minimum 400 (~486 förväntat) |
| INFO | count: customers (totalt) | 0 |
| FAIL | count: objects (aktiva) | 0 objekt — under förväntat minimum 1 |
| INFO | count: clusters | 0 |
| INFO | count: resources | 5 |
| INFO | count: resource_profiles | 0 |
| INFO | count: resource_profile_assignments | 0 |
| INFO | count: teams | 7 |
| FAIL | count: team_members | 0 (förväntade > 0) |
| INFO | count: vehicles | 1 |
| INFO | count: equipment | 0 |
| INFO | count: articles | 2 |
| INFO | count: article_components | 0 |
| FAIL | count: price_lists (tenant) | 0 (förväntade > 0) |
| INFO | count: price_lists (kund) | 0 |
| FAIL | count: price_list_articles | 0 (förväntade > 0) |
| INFO | count: checklist_templates | 0 |
| INFO | count: metadata_definitions | 0 |
| INFO | count: portal_users | 0 |
| INFO | count: portal_user_object_scopes | 0 |
| FAIL | count: fortnox_config | 0 (förväntade > 0) |
| INFO | count: fortnox_mappings | 0 |
| PASS | count: work_orders (förväntat 0) | 0 (slim-migrering) |
| FAIL | diff: customers (aktiva) | dev=37, prod=0 |
| WARN | diff: objects (aktiva) | dev=95, prod=0 (prod < dev) |
| WARN | diff: articles | dev=7, prod=2 (prod < dev) |
| PASS | diff: price_lists (tenant) | dev=0, prod=0 |
| WARN | diff: teams | dev=23, prod=7 (prod < dev) |
| WARN | diff: resources | dev=25, prod=5 (prod < dev) |
| PASS | orphans: objects.parent_id | 0 orphan(s) |
| PASS | orphans: objects.customer_id | 0 orphan(s) |
| PASS | orphans: clusters.root_customer_id | 0 orphan(s) |
| PASS | orphans: price_lists.customer_id | 0 orphan(s) |
| PASS | orphans: price_list_articles → price_lists (global) | 0 orphan(s) |
| PASS | orphans: portal_user_object_scopes (kinab) | 0 orphan(s) |
| PASS | orphans: team_members (kinab) | 0 orphan(s) |
| PASS | leak: alla 56 kontrollerade tabeller | 0 läckor |
| FAIL | config: fortnox_config | ingen rad för tenant |
| PASS | config: tenants[id=kinab] | 1 rad(er) |
| PASS | config: minst en owner/admin | 4 owner/admin-roll(er) i prod |

## Manuella efter-steg (operatör)

- [ ] Logga in i prod-appen som tenant-admin för `kinab` och
      bekräfta att Customers, Objekt, Resurser, Team, Artiklar,
      Prislistor och Fortnox-status visas korrekt.
- [ ] Ta `pg_dump` av prod-DB:n och lagra som rollback-snapshot
      (Replit Publish → Database → Snapshots, eller `pg_dump
      "$PROD_DATABASE_URL" > kinab-prod-postverify-20260615-1503.sql`).
- [ ] Säg klart till Kinab att Modus-importen kan köras skarpt.

VERIFIKATION: FAIL
