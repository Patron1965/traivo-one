-- Städa eventuella dubblettkopplingar i fortnox_mappings innan vi sätter unikt index.
-- Behåll äldsta raden (lägsta created_at, sedan lägsta id) per (tenant_id, entity_type, fortnox_id)
-- och radera resten.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY tenant_id, entity_type, fortnox_id
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM fortnox_mappings
)
DELETE FROM fortnox_mappings
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Unikt index: en (tenant_id, entity_type, fortnox_id)-trippel får bara mappas en gång.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fortnox_mappings_tenant_entity_fortnox
  ON fortnox_mappings (tenant_id, entity_type, fortnox_id);
