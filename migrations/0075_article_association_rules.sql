-- Task #835 (Artikel Fas 2): konsolidera fasthakning + objekttyper + etikett-association
-- till en enda regelarray articles.association_rules (AND-villkor).
--
-- Expand-contract: kolumnen läggs till nullable med default [], och ALLA gamla kolumner
-- (hook_level, hook_conditions, object_types, association_label/value/operator) behålls.
-- Inga drops i denna migration.
--
-- Paritet: hook_level-villkoret evalueras i koden med EXAKT samma matchare som tidigare
-- (server/association-service.ts legacyHookMatch, extraherad ordagrant från resolvern).
-- object_type-villkor påverkar inte resolvern (objektTyper gjorde det aldrig) — endast
-- mobil-relevansfiltret. metadata-villkor (migrerade från association_label) gör att
-- etikett-associerade artiklar nu hakar via resolvern — avsedd konsolidering i Fas 2.

-- 1) Lägg till kolumnen (idempotent).
ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS association_rules jsonb DEFAULT '[]'::jsonb;

-- 2) Back-fill regler från legacy-fält. Idempotent: rör bara rader som ännu inte har
--    regler (association_rules NULL eller []) och som faktiskt har något att migrera.
UPDATE articles SET association_rules = (
  -- hook_level → {source:hook_level, level, conditions?}
  (CASE
     WHEN hook_level IS NOT NULL AND hook_level <> '' THEN
       jsonb_build_array(
         jsonb_strip_nulls(jsonb_build_object(
           'source', 'hook_level',
           'level', hook_level,
           'conditions', CASE
             WHEN hook_conditions IS NOT NULL AND hook_conditions <> '{}'::jsonb
               THEN hook_conditions
             ELSE NULL
           END
         ))
       )
     ELSE '[]'::jsonb
   END)
  ||
  -- object_types → {source:object_type, types[]}
  (CASE
     WHEN object_types IS NOT NULL AND array_length(object_types, 1) > 0 THEN
       jsonb_build_array(jsonb_build_object(
         'source', 'object_type',
         'types', to_jsonb(object_types)
       ))
     ELSE '[]'::jsonb
   END)
  ||
  -- association_label/value/operator → {source:metadata, label, operator, value}
  (CASE
     WHEN association_label IS NOT NULL AND association_label <> ''
          AND association_value IS NOT NULL THEN
       jsonb_build_array(jsonb_build_object(
         'source', 'metadata',
         'label', association_label,
         'operator', COALESCE(NULLIF(association_operator, ''), 'equals'),
         'value', association_value
       ))
     ELSE '[]'::jsonb
   END)
)
WHERE (association_rules IS NULL OR association_rules = '[]'::jsonb)
  AND (
       (hook_level IS NOT NULL AND hook_level <> '')
    OR (object_types IS NOT NULL AND array_length(object_types, 1) > 0)
    OR (association_label IS NOT NULL AND association_label <> '' AND association_value IS NOT NULL)
  );

-- 3) Säkerställ att inga rader har NULL (default gäller bara nya rader).
UPDATE articles SET association_rules = '[]'::jsonb WHERE association_rules IS NULL;
