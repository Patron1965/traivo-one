-- Task #569: spåra import-batch på object_payers och invoice_recipients
-- så /api/import/rollback/:batchId kan ångra payers/recipients-importer.
-- Nullable (expand-contract) — befintliga manuellt skapade rader behåller NULL
-- och påverkas aldrig av rollback.
-- object_payers droppades i migration 0129 (Etapp 5). Guarda så replay blir
-- no-op när tabellen är borta men fungerar om den fortfarande finns mid-replay.
DO $$ BEGIN
  IF to_regclass('public.object_payers') IS NOT NULL THEN
    ALTER TABLE "object_payers" ADD COLUMN IF NOT EXISTS "import_batch_id" text;
    CREATE INDEX IF NOT EXISTS "idx_object_payers_import_batch" ON "object_payers" ("import_batch_id");
  END IF;
END $$;
ALTER TABLE "invoice_recipients" ADD COLUMN IF NOT EXISTS "import_batch_id" text;
CREATE INDEX IF NOT EXISTS "idx_invoice_recipients_import_batch" ON "invoice_recipients" ("import_batch_id");
