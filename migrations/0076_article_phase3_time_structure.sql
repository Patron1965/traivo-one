-- Task #836 (Artikel Fas 3): Tid, struktur & beroenden.
--
-- Inför tydlig åtskillnad mellan produktionstid, offsettid och ledtid samt
-- beroendeartikel-flaggor. Expand-contract: alla kolumner läggs till nullable/med
-- default. Inga drops. Befintlig logik läser inte article.offset_minutes vid expand,
-- så att flytta positiv offset → lead_time_days ändrar inte planerat beteende.

-- 1) Nya artikelkolumner (idempotent).
ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS lead_time_days integer;
ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS requires_acknowledgment boolean DEFAULT false;
ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS dependency_criticality text DEFAULT 'critical';

-- 2) Kvittens-spårning på arbetsorder (beroendeuppgift) (idempotent).
ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS dependency_acknowledged_at timestamp;
ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS dependency_acknowledged_by varchar;
ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS dependency_criticality text;

-- 2b) Beroendeuppgift-flaggor på assignments (orderkoncept-expansion skapar
--     beroendeartiklar som egna assignments, inte work_orders) (idempotent).
ALTER TABLE assignments
  ADD COLUMN IF NOT EXISTS requires_acknowledgment boolean DEFAULT false;
ALTER TABLE assignments
  ADD COLUMN IF NOT EXISTS dependency_criticality text;
ALTER TABLE assignments
  ADD COLUMN IF NOT EXISTS dependency_acknowledged_at timestamp;
ALTER TABLE assignments
  ADD COLUMN IF NOT EXISTS dependency_acknowledged_by varchar;

-- 3) Migrera tidigare felaktigt överlastad "leveranstid" (positiv offset_minutes)
--    till lead_time_days. Idempotent: rör bara rader som ännu inte har ledtid satt
--    och som har positiv offset. Avrundar uppåt till hela dagar (1440 min/dag) så att
--    "beställ X dagar innan" aldrig blir för kort. Nollställer offsetten efteråt så att
--    offsettid endast betyder före/samtidigt/efter och inte längre leveranstid.
UPDATE articles
   SET lead_time_days = CEIL(offset_minutes::numeric / 1440.0)::integer,
       offset_minutes = 0
 WHERE lead_time_days IS NULL
   AND offset_minutes > 0;

-- 4) Säkerställ default-värden på äldre rader (default gäller bara nya rader).
UPDATE articles SET requires_acknowledgment = false WHERE requires_acknowledgment IS NULL;
UPDATE articles SET dependency_criticality = 'critical' WHERE dependency_criticality IS NULL;
