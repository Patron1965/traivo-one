-- Task #1334: Backfill av displayName för befintliga ruttförslag.
-- Task #1333 döpte om UI-text och nygenererade fallback-namn från
-- "Ruttklump YYYY-MM-DD" till "Ruttförslag YYYY-MM-DD", men befintliga rader
-- i route_clusters behöll sitt sparade namn. Denna migration uppdaterar
-- ENDAST auto-genererade namn (exakt mönster "Ruttklump YYYY-MM-DD") —
-- manuellt namngivna klumpar rörs ej. Idempotent: efter körning matchar
-- ingen rad längre mönstret.
DO $$
BEGIN
  IF to_regclass('public.route_clusters') IS NOT NULL THEN
    UPDATE route_clusters
    SET display_name = 'Ruttförslag ' || substring(display_name FROM 11)
    WHERE display_name ~ '^Ruttklump \d{4}-\d{2}-\d{2}$';
  END IF;
END $$;
