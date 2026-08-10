-- Task #1500 (contract-fas efter #1496): droppa legacy-dubbletten
-- articles.performer_category. executionCode (execution_code) är kanoniskt.
-- Best-effort säkerhetsnät: kopiera perf→exec för legacy-rader innan drop.
-- Guardat så satsen blir no-op när kolumnen redan är borta (db:push pre-droppar).
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'articles' AND column_name = 'performer_category'
  ) THEN
    UPDATE articles
    SET execution_code = performer_category
    WHERE (execution_code IS NULL OR execution_code = '')
      AND performer_category IS NOT NULL AND performer_category <> '';
  END IF;
END $$;

ALTER TABLE articles DROP COLUMN IF EXISTS performer_category;
