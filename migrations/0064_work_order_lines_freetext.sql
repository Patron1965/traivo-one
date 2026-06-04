-- Enkel uppgift (Task #736): fritext-/blindgångar-rader på work_order_lines.
-- Expand-contract: article_id blir nullable och en fritext-beskrivning läggs till
-- så att rader utan artikel (manuellt pris/tid) kan sparas. Idempotent.
ALTER TABLE work_order_lines ALTER COLUMN article_id DROP NOT NULL;
ALTER TABLE work_order_lines ADD COLUMN IF NOT EXISTS description text;
