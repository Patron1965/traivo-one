-- Task #1348: Contract-fas för tre-stegs import-wizarden (borttagen i Task #1346).
-- Tabellen `import_sessions` (wizard-bunden interim → objectId-mapping, task #578)
-- har inga läsare/skrivare kvar och tas nu bort ur DB och shared/schema.ts.
-- OBS: rör INTE `object_import_sessions` (Import 2.0) — helt separat tabell.
--
-- `import_batches.session_id` (+ idx_import_batches_session) BEHÅLLS medvetet:
-- kolumnen konsumeras fortfarande av Import 2.0 (objectImportV2Routes stämplar
-- den med object_import_sessions-id, sourceFlow='objects-v2'). Endast den gamla
-- FK:n mot import_sessions (migration 0049) tas bort — shared/schema.ts har
-- aldrig deklarerat någon FK på kolumnen, så db:push återskapar den inte.
--
-- Idempotent: DROP ... IF EXISTS är no-op vid replay.
ALTER TABLE IF EXISTS "import_batches"
  DROP CONSTRAINT IF EXISTS "import_batches_session_id_fkey";
ALTER TABLE IF EXISTS "import_batches"
  DROP CONSTRAINT IF EXISTS "import_batches_session_id_import_sessions_id_fk";
DROP TABLE IF EXISTS "import_sessions" CASCADE;
